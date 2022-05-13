import { info, log } from "@changesets/logger";
import {
  ChangeType,
  ChangesetWithConfirmed,
  Release,
  Config,
  VersionType,
  Changeset
} from "@changesets/types";
import path from "path";
import { Package } from "@manypkg/get-packages";
import chalk from "chalk";

import { getCommitFunctions } from "../../commit/getCommitFunctions";
import * as cli from "../../utils/cli-utilities";
import printConfirmationMessage from "./messages";
import * as git from "@changesets/git";
import { determineEditorHack, warnIfMajor } from ".";

type WriteChangesetListArgs = {
  changesets: ChangesetWithConfirmed[];
  packages: Package[];
  cwd: string;
  changesetBase: string;
  empty?: boolean;
  config: Config;
  open?: boolean;
  // @TODO fix bug where can't import writeChangeset from "@changesets/write"
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
  // @TODO refactor current flow to use it here and reduce duplicate code
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

    warnIfMajor(changeset);

    const changesetPath = path.resolve(changesetBase, `${changesetID}.md`);
    info(chalk.blue(changesetPath));

    if (open) determineEditorHack(changesetPath);
  }
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
    .map(chk => `- [ ${chk.category.title} ] ${chk.description}`)
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
