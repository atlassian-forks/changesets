import { log } from "@changesets/logger";
import {
  ChangeType,
  ChangesetWithConfirmed,
  EmptyString,
  Release,
  Config,
  VersionType
} from "@changesets/types";
import chalk from "chalk";

import * as cli from "../../utils/cli-utilities";
import changeTypeList from "./changeTypeList.json";

const { bold, cyan } = chalk;

type ChangeTypeOption = { title: string; text: string };
const allChangeTypes: ChangeTypeOption[] = changeTypeList;

type PreviousAnswers = { [key in string]: string };
export class ChangesetsWithChangeTypes {
  private config: Config;
  private isWithChangeTypes: boolean = false;
  private releases: Release[] = [];
  private chosenChangeTypeList: ChangeTypeOption[] = [];
  private changesetList: ChangesetWithConfirmed[] = [];

  constructor(config: Config) {
    this.config = config;
  }

  async setChangeTypeList() {
    if (!this.config.shouldAskForChangeTypes) return;
    const choosenTitleList = await getChangeTypeList();

    this.chosenChangeTypeList = choosenTitleList.map(title => ({
      title,
      text: allChangeTypes.find(cht => cht.title === title)!.text
    }));

    this.isWithChangeTypes = choosenTitleList?.length > 0;
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
    allChangeTypes.map(changeType => ({
      name: changeType.title,
      message: changeType.text
    })),
    (chosenChangeTypeList: EmptyString | string[]) => {
      if (Array.isArray(chosenChangeTypeList)) {
        return chosenChangeTypeList.map(x => cyan(x)).join(", ");
      }
    }
  );
}

async function getChangesetList(
  releases: Release[],
  chosenChangeTypeList: ChangeTypeOption[]
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
  chosenChangeTypeList: ChangeTypeOption[]
) {
  const releaseWithChangeTypeList: Array<Release> = [];

  for (const bumpType of bumpTypes) {
    const changeTypeList: Array<ChangeType> = [];
    const pkgsForThisBumpType = releases
      .filter((rel: Release) => rel.type === bumpType)
      .map((rel: Release) => rel.name)
      .join(", ");

    log(chalk.yellow(`${bumpType} :`), chalk.cyan(pkgsForThisBumpType));

    for (const category of chosenChangeTypeList) {
      const description = await cli.askQuestion(`[ ${category.title} ]`);
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
  chosenChangeTypeList: ChangeTypeOption[]
) {
  const changesetList: Array<ChangesetWithConfirmed> = [];
  const previousAnswers: PreviousAnswers = {};

  for (const release of releases) {
    log(chalk.yellow(`${release.type} :`), chalk.cyan(release.name));
    const currChangeTypeList: ChangeType[] = [];

    for (const category of chosenChangeTypeList) {
      const description = await getDescriptionWithPreviousAnswer(
        previousAnswers,
        category
      );
      currChangeTypeList.push({ description, category });
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

async function getDescriptionWithPreviousAnswer(
  previousAnswers: PreviousAnswers,
  category: ChangeTypeOption
) {
  const previousAnswer = previousAnswers[category.title];
  const question = `Do you want to reuse your previous answer for the current package? (${previousAnswer})`;
  if (previousAnswer) {
    const shouldReusePreviousAnswer = await cli.askConfirm(question);
    if (shouldReusePreviousAnswer) return previousAnswer;
  }

  const description = await cli.askQuestion(`[ ${category.title} ]`);
  previousAnswers[category.title] = description;
  return description;
}

// @TODO merge duplicate setSummary with existing
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
