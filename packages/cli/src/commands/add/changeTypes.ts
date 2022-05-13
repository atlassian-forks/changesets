import { info, log, warn } from "@changesets/logger";
import {
  ChangeType,
  ChangesetWithConfirmed,
  EmptyString,
  Release,
  Config,
  VersionType,
  Changeset
} from "@changesets/types";
import path from "path";
import { Package } from "@manypkg/get-packages";
import chalk from "chalk";
import { ExternalEditor } from "external-editor";
import spawn from "spawndamnit";
// import writeChangeset from "@changesets/write";

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
  "UX (UX change)",
  "Misc (Anything else not noted above)"
];
export function getKindTitle(kind: string) {
  return kind.split(" ")[0];
}

type PreviousAnswers = { [key in string]: string };

export class ChangesetsWithChangeTypes {
  private config: Config;
  private isWithChangeTypes: boolean = false;
  private releases: Release[] = [];
  private chosenChangeTypeList: string[] = [];
  private changesetList: ChangesetWithConfirmed[] = [];

  constructor(config: Config) {
    this.config = config;
  }

  async setChangeTypeList() {
    const chosenChangeTypeList = await getChangeTypeList();
    this.chosenChangeTypeList = chosenChangeTypeList;
    this.isWithChangeTypes = chosenChangeTypeList?.length > 0;
  }

  async setReleases(newReleases: Release[]) {
    if (!this.isWithChangeTypes) return;
    this.releases = newReleases;
  }

  async setChangesetList() {
    if (!this.isWithChangeTypes) return;
    if (!this.releases.length || !this.chosenChangeTypeList.length)
      throw new Error("releases and chosenChangeTypeList must be set");

    this.changesetList = await getChangesetList(
      this.releases,
      this.chosenChangeTypeList
    );
  }

  async setSummaries() {
    if (!this.isWithChangeTypes) return;
    if (!this.changesetList.length)
      throw new Error("changesetList must be set");

    for (let changeset of this.changesetList)
      await setSummary(changeset, this.config);
  }

  async getFinalChangesetList() {
    if (!this.isWithChangeTypes) return;
    if (!this.changesetList.length)
      throw new Error("changesetList must be set");

    return this.changesetList;
  }
}

async function getChangeTypeList() {
  return cli.askCheckboxPlus(
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
}

async function getChangesetList(
  releases: Release[],
  chosenChangeTypeList: string[]
) {
  const changesetList: Array<ChangesetWithConfirmed> = [];
  const bumpTypes = new Set(releases.map(rel => rel.type));

  const isSameMessageForAllPkgs = await cli.askConfirm(
    "Would you like to reuse the same message for all packages of this bump type?"
  );

  if (isSameMessageForAllPkgs) {
    const releaseWithChangeTypeList = await getReleasesPerBumpType(
      bumpTypes,
      releases,
      chosenChangeTypeList
    );

    changesetList.push({
      releases: releaseWithChangeTypeList,
      confirmed: false,
      summary: ""
    });
  } else {
    const newChangesetList = await getReleasesPerPackage(
      releases,
      chosenChangeTypeList
    );
    changesetList.push(...newChangesetList);
  }
  return changesetList;
}

async function getReleasesPerBumpType(
  bumpTypes: Set<VersionType>,
  releases: Release[],
  chosenChangeTypeList: string[]
) {
  const releaseWithChangeTypeList: Array<Release> = [];

  for (const bumpType of bumpTypes) {
    const changeTypeList: Array<ChangeType> = [];
    const pkgsForThisBumpType = releases
      .filter((rel: { type: any }) => rel.type === bumpType)
      .map((rel: { name: any }) => rel.name)
      .join(", ");

    log(chalk.yellow(`${bumpType} :`), chalk.cyan(pkgsForThisBumpType));

    for (const category of chosenChangeTypeList) {
      const description = await cli.askQuestion(
        `[ ${getKindTitle(category)} ]`
      );
      changeTypeList.push({ description, category });
    }

    const releasesWithChangeTypes = releases
      .filter((rel: { type: any }) => rel.type === bumpType)
      .map((rel: any) => ({ ...rel, changeTypes: changeTypeList }));

    releaseWithChangeTypeList.push(...releasesWithChangeTypes);
  }
  return releaseWithChangeTypeList;
}

async function getReleasesPerPackage(
  releases: Release[],
  chosenChangeTypeList: string[]
) {
  const changesetList: Array<ChangesetWithConfirmed> = [];
  const previousAnswers: PreviousAnswers = {};

  for (const release of releases) {
    log(chalk.yellow(`${release.type} :`), chalk.cyan(release.name));
    const currChangeTypeList: ChangeType[] = [];

    for (const category of chosenChangeTypeList) {
      const description = await getDescriptionWithPrev(
        previousAnswers,
        category
      );
      currChangeTypeList.push({
        description,
        category
      });
    }
    const releaseWithChangeTypeList = [
      { ...release, changeTypes: currChangeTypeList }
    ];
    changesetList.push({
      confirmed: false,
      summary: "",
      releases: releaseWithChangeTypeList
    });
  }
  return changesetList;
}

type WriteChangesetListArgs = {
  changesets: ChangesetWithConfirmed[];
  packages: Package[];
  cwd: string;
  changesetBase: string;
  empty?: boolean;
  config: Config;
  open?: boolean;
  writeChangeset: (changeset: Changeset, cwd: string) => Promise<string>;
};
export async function writeChangesetList({
  changesets,
  packages,
  cwd,
  changesetBase,
  empty,
  config,
  open,
  writeChangeset
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

async function getDescriptionWithPrev(
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

async function setSummary(changeSet: ChangesetWithConfirmed, config: Config) {
  log(
    "Please enter a summary for this change (this will be in the changelogs)."
  );
  log(chalk.gray("  (submit empty line to open external editor)"));

  let summary = config.alwaysOpenEditor ? "" : await cli.askQuestion("Summary");
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

function groupByBumpType(releases: Release[]) {
  const major: Release[] = [];
  const minor: Release[] = [];
  const patch: Release[] = [];
  const none: Release[] = [];

  releases.forEach(rel => {
    if (rel.type === "major") major.push(rel);
    else if (rel.type === "minor") minor.push(rel);
    else if (rel.type === "patch") patch.push(rel);
    else major.push(rel);
  });
  return { major, minor, patch, none };
}
function getReleasesSection(releases: Release[]) {
  return `---
${releases.map(release => `"${release.name}": ${release.type}`).join("\n")}
---\n`;
}
function getChangeTypesSection(releases: Release[], bumpType?: VersionType) {
  let changeTypes: ChangeType[] = [];

  if (bumpType) {
    const [oneRelease] = releases.filter(({ type }) => type === bumpType);
    if (!oneRelease?.changeTypes) changeTypes = [];
    else changeTypes = oneRelease.changeTypes;
  } else {
    changeTypes = releases.flatMap(rel => rel.changeTypes || []);
  }

  return `${changeTypes
    .filter(chk => chk.description)
    .map(chk => `- [ ${getKindTitle(chk.category)} ] ${chk.description}`)
    .join("\n")}\n`;
}

export function getChangesetContent(
  releases: Release[],
  summary: string,
  splitReleasesByBumpType = false
) {
  if (splitReleasesByBumpType && releases.some(rel => rel.changeTypes)) {
    const grouped = Object.entries(groupByBumpType(releases)).filter(
      ([, releases]) => releases.length
    ) as [VersionType, Release[]][];

    return `${grouped
      .map(
        ([bumpType, releases]) =>
          `${getReleasesSection(releases)}
${getChangeTypesSection(releases, bumpType)}`
      )
      .join("\n")}

${summary}
`;
  }

  if (releases.some(rel => rel.changeTypes))
    return `${getReleasesSection(releases)} 
  ${getChangeTypesSection(releases)}

${summary}
`;
  return null;
}
