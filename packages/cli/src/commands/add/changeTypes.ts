import { info, log, warn } from "@changesets/logger";
import {
  ChangeType,
  ChangesetWithConfirmed,
  EmptyString,
  Release,
  Config
} from "@changesets/types";
import path from "path";
import writeChangeset from "@changesets/write";
import { Package } from "@manypkg/get-packages";
import chalk from "chalk";
import { ExternalEditor } from "external-editor";
import spawn from "spawndamnit";

import { getCommitFunctions } from "../../commit/getCommitFunctions";
import * as cli from "../../utils/cli-utilities";
import printConfirmationMessage from "./messages";
import * as git from "@changesets/git";

const { bold, cyan } = chalk;

const allCategoriesOfChange = [
  "Added (New functionality, arg options, more UI elements)",
  "Changed (Visual changes, internal changes, API changes)",
  "Removed (Dead code, feature flags, consumer API's)",
  "Types (Strictly related to the type system and should not have impact on runtime code) ",
  "Documentation (README, general docs, package.json metadata)",
  "Infra (Tooling, performance, things that are under the hood but should have no impact if a consumer upgraded)",
  "Misc (Anything else not noted above)"
];
export function getKindTitle(kind: string) {
  return kind.split(" ")[0];
}

type PreviousAnswers = { [key in string]: string };

export async function createChangesetWithChangeTypes(releases: Release[]) {
  //   const changeTypeList: Array<ChangeType> = [];
  const changesetList: Array<ChangesetWithConfirmed> = [];
  const releaseWithChangeTypeList: Array<Release> = [];
  let shouldAskChangeTypes = false;

  const chosenChangeTypeList = await cli.askCheckboxPlus(
    bold(`What kind of change are you making? (check all that apply)`),
    allCategoriesOfChange.map(changeType => ({
      name: changeType,
      message: changeType
    })),
    (chosenChangeTypeList: EmptyString | string[]) => {
      if (Array.isArray(chosenChangeTypeList)) {
        return chosenChangeTypeList.map(x => cyan(getKindTitle(x))).join(", ");
      }
    }
  );
  shouldAskChangeTypes = chosenChangeTypeList.length > 0;
  if (!shouldAskChangeTypes) return false;

  const bumpTypes = new Set(releases.map(rel => rel.type));
  const isSameMessageForAllPkgs = await cli.askConfirm(
    "Would you like to reuse the same message for all packages of this bump type?"
  );

  if (isSameMessageForAllPkgs) {
    for (const bumpType of bumpTypes) {
      const changeTypeList: Array<ChangeType> = [];
      const pkgsForThisBumpType = releases
        .filter(rel => rel.type === bumpType)
        .map(rel => rel.name)
        .join(", ");

      log(chalk.yellow(`${bumpType} :`), chalk.cyan(pkgsForThisBumpType));

      for (const category of chosenChangeTypeList) {
        const description = await cli.askQuestion(
          `[ ${getKindTitle(category)} ]`
        );
        changeTypeList.push({ description, category });
      }

      const releasesWithChangeTypes = releases
        .filter(rel => rel.type === bumpType)
        .map(rel => ({ ...rel, changeTypes: changeTypeList }));

      releaseWithChangeTypeList.push(...releasesWithChangeTypes);
    }
    changesetList.push({
      releases: releaseWithChangeTypeList,
      confirmed: false,
      summary: ""
    });
  } else {
    const previousAnswers: PreviousAnswers = {};
    for (const release of releases) {
      log(chalk.yellow(`${release.type} :`), chalk.cyan(release.name));
      const currChangesetChangeTypeList: ChangeType[] = [];

      for (const category of chosenChangeTypeList) {
        const description = await getDescription(previousAnswers, category);
        currChangesetChangeTypeList.push({
          description,
          category
        });
      }
      const releaseWithChangeTypeList = [
        { ...release, changeTypes: currChangesetChangeTypeList }
      ];
      changesetList.push({
        confirmed: false,
        summary: "",
        releases: releaseWithChangeTypeList
      });
    }
  }

  for (let changeset of changesetList) {
    await setSummary(changeset);
  }
}
type WriteChangesetListArgs = {
  changesets: ChangesetWithConfirmed[];
  packages: Package[];
  cwd: string;
  changesetBase: string;
  empty?: boolean;
  config: Config;
  open?: boolean;
};
export async function writeChangesetList({
  changesets,
  packages,
  cwd,
  changesetBase,
  empty,
  config,
  open
}: WriteChangesetListArgs) {
  for (let changeset of changesets) {
    printConfirmationMessage(changeset, packages.length > 1);

    if (!changeset.confirmed) {
      changeset = {
        ...changeset,
        confirmed: await cli.askConfirm("Is this your desired changeset?")
      };
    }

    if (!changeset.confirmed) continue;

    const changesetID = await writeChangeset(changeset, cwd);
    const [{ getAddMessage }, commitOpts] = getCommitFunctions(
      config.commit,
      cwd
    );
    if (getAddMessage) {
      await git.add(path.resolve(changesetBase, `${changesetID}.md`), cwd);
      await git.commit(await getAddMessage(changeset, commitOpts), cwd);
      log(chalk.green(`${empty ? "Empty " : ""}Changeset added and committed`));
    } else {
      log(
        chalk.green(
          `${empty ? "Empty " : ""}Changeset added! - you can now commit it\n`
        )
      );
    }

    let hasMajorChange = [...changeset.releases].find(c => c.type === "major");

    if (hasMajorChange) {
      warn(
        "This Changeset includes a major change and we STRONGLY recommend adding more information to the changeset:"
      );
      warn("WHAT the breaking change is");
      warn("WHY the change was made");
      warn("HOW a consumer should update their code");
    } else {
      log(
        chalk.green(
          "If you want to modify or expand on the changeset summary, you can find it here"
        )
      );
    }

    const changesetPath = path.resolve(changesetBase, `${changesetID}.md`);
    info(chalk.blue(changesetPath));

    if (open) {
      // this is really a hack to reuse the logic embedded in `external-editor` related to determining the editor
      const externalEditor = new ExternalEditor();
      externalEditor.cleanup();
      spawn(
        externalEditor.editor.bin,
        externalEditor.editor.args.concat([changesetPath]),
        {
          detached: true,
          stdio: "inherit"
        }
      );
    }
  }
}

async function getDescription(
  previousAnswers: PreviousAnswers,
  category: string
) {
  const previousAnswer = previousAnswers[category];
  const question = `Do you want to reuse your previous answer for the current package? (${previousAnswer})`;
  if (previousAnswer) {
    const shouldReusePreviousAnswer = await cli.askConfirm(question);
    if (shouldReusePreviousAnswer) return previousAnswer;
  }

  const description = await cli.askQuestion(`[ ${getKindTitle(category)} ]`);
  previousAnswers[category] = description;
  return description;
}

async function setSummary(changeSet: ChangesetWithConfirmed) {
  log(
    "Please enter a summary for this change (this will be in the changelogs)."
  );
  log(chalk.gray("  (submit empty line to open external editor)"));

  let summary = await cli.askQuestion("Summary");
  if (summary.length === 0) {
    try {
      summary = cli.askQuestionWithEditor(
        "\n\n# Please enter a summary for your changes.\n# An empty message aborts the editor."
      );
      if (summary.length > 0) {
        changeSet.summary = summary;
        changeSet.confirmed = true;
        return;
      }
    } catch (err) {
      log(
        "An error happened using external editor. Please type your summary here:"
      );
    }

    summary = await cli.askQuestion("");
    while (summary.length === 0) {
      summary = await cli.askQuestion(
        "\n\n# A summary is required for the changelog! 😪"
      );
    }
  }

  changeSet.summary = summary;
  changeSet.confirmed = false;
}
