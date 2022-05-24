import path from "path";
import fixtures from "fixturez";
import stripAnsi from "strip-ansi";
import * as git from "@changesets/git";
import { defaultConfig } from "@changesets/config";
import { silenceLogsInBlock } from "@changesets/test-utils";
import writeChangeset from "@changesets/write";

import {
  askCheckboxPlus,
  askConfirm,
  askQuestionWithEditor,
  askQuestion,
  askList
} from "../../../utils/cli-utilities";
import addChangeset from "..";
import changeTypeList from "../changeTypeList.json";

const f = fixtures(__dirname);

jest.mock("../../../utils/cli-utilities");
jest.mock("@changesets/git");
jest.mock("@changesets/write");
// @ts-ignore
writeChangeset.mockImplementation(() => Promise.resolve("abcdefg"));
// @ts-ignore
git.commit.mockImplementation(() => Promise.resolve(true));

// @ts-ignore
git.getChangedPackagesSinceRef.mockImplementation(({ ref }) => {
  expect(ref).toBe("master");
  return [];
});

function getChangeTypeDescriptions(
  questionsAmount: number,
  providedDescriptions?: string[]
) {
  const sampleDescriptions = Array(questionsAmount).fill(
    "sample changeType description"
  );
  const descriptions = providedDescriptions || [];
  return [...descriptions, ...sampleDescriptions].slice(0, questionsAmount);
}

const MOCK_SUMMARY = "summary message mock";

// @ts-ignore
const mockUserResponses = mockResponses => {
  const summary = mockResponses.summary || MOCK_SUMMARY;
  const { changeTypes } = mockResponses;
  let majorReleases: Array<string> = [];
  let minorReleases: Array<string> = [];
  Object.entries(mockResponses.releases).forEach(([pkgName, type]) => {
    if (type === "major") {
      majorReleases.push(pkgName);
    } else if (type === "minor") {
      minorReleases.push(pkgName);
    }
  });
  let callCount = 0;
  let returnValues = [
    Object.keys(mockResponses.releases),
    majorReleases,
    minorReleases
  ];
  // @ts-ignore
  askCheckboxPlus.mockImplementation(() => {
    if (callCount === returnValues.length) {
      throw new Error(`There was an unexpected call to askCheckboxPlus`);
    }
    return returnValues[callCount++];
  });

  let confirmAnswers = {
    "Is this your desired changeset?": true,
    "Would you like to reuse the same message for all packages of this bump type?":
      changeTypes?.isSameMsgPerBumpType,
    "Do you want to reuse your previous answer for the current package?":
      changeTypes?.shouldReusePrevPkgAnswer
  };

  if (changeTypes) {
    const changeTypeQuestionStepIdx = 1;
    returnValues.splice(changeTypeQuestionStepIdx, 0, changeTypes.changeTypes);
  }

  if (mockResponses.consoleSummaries && mockResponses.editorSummaries) {
    let i = 0;
    let j = 0;
    // @ts-ignore
    askQuestion.mockImplementation(() => mockResponses.consoleSummaries[i++]);
    // @ts-ignore
    askQuestionWithEditor.mockImplementation(
      () => mockResponses.editorSummaries[j++]
    );
  } else if (changeTypes) {
    const isSingleSummary = changeTypes.isSameMsgPerBumpType;
    const summaries = isSingleSummary ? [MOCK_SUMMARY] : changeTypes.summaries;
    const answers = [...changeTypes.descriptions, ...summaries];
    let descriptionCount = 0;
    // @ts-ignore
    askQuestion.mockImplementation(() => {
      if (descriptionCount === answers.length)
        throw new Error(`There was an unexpected call to askQuestion`);
      return answers[descriptionCount++];
    });
  } else {
    // @ts-ignore
    askQuestion.mockReturnValueOnce(summary);
  }

  // @ts-ignore
  askConfirm.mockImplementation(question => {
    question = stripAnsi(question);
    // remove question hint ...? (hint)
    question = question.slice(0, question.indexOf("?") + 1);
    // @ts-ignore
    if (question in confirmAnswers) {
      // @ts-ignore
      return confirmAnswers[question];
    }
    throw new Error(`An answer could not be found for ${question}`);
  });
};

describe("Changesets", () => {
  silenceLogsInBlock();

  it("should generate changeset to patch a single package", async () => {
    const cwd = await f.copy("simple-project");

    mockUserResponses({ releases: { "pkg-a": "patch" } });
    await addChangeset(cwd, { empty: false }, defaultConfig);

    // @ts-ignore
    const call = writeChangeset.mock.calls[0][0];
    expect(call).toEqual(
      expect.objectContaining({
        summary: "summary message mock",
        releases: [{ name: "pkg-a", type: "patch" }]
      })
    );
  });

  it.each`
    consoleSummaries                          | editorSummaries                           | expectedSummary
    ${["summary on step 1"]}                  | ${[]}                                     | ${"summary on step 1"}
    ${[""]}                                   | ${["summary in external editor"]}         | ${"summary in external editor"}
    ${["", "summary after editor cancelled"]} | ${[""]}                                   | ${"summary after editor cancelled"}
    ${["", "summary after error"]}            | ${1 /* mock implementation will throw */} | ${"summary after error"}
  `(
    "should read summary",
    // @ts-ignore
    async ({ consoleSummaries, editorSummaries, expectedSummary }) => {
      const cwd = await f.copy("simple-project");

      mockUserResponses({
        releases: { "pkg-a": "patch" },
        consoleSummaries,
        editorSummaries
      });
      await addChangeset(cwd, { empty: false }, defaultConfig);

      // @ts-ignore
      const call = writeChangeset.mock.calls[0][0];
      expect(call).toEqual(
        expect.objectContaining({
          summary: expectedSummary,
          releases: [{ name: "pkg-a", type: "patch" }]
        })
      );
    }
  );

  it("should generate a changeset in a single package repo", async () => {
    const cwd = await f.copy("single-package");

    const summary = "summary message mock";

    // @ts-ignore
    askList.mockReturnValueOnce(Promise.resolve("minor"));

    let confirmAnswers = {
      "Is this your desired changeset?": true
    };
    // @ts-ignore
    askQuestion.mockReturnValueOnce("");
    // @ts-ignore
    askQuestionWithEditor.mockReturnValueOnce(summary);
    // @ts-ignore
    askConfirm.mockImplementation(question => {
      question = stripAnsi(question);
      // @ts-ignore
      if (confirmAnswers[question]) {
        // @ts-ignore
        return confirmAnswers[question];
      }
      throw new Error(`An answer could not be found for ${question}`);
    });

    await addChangeset(cwd, { empty: false }, defaultConfig);

    // @ts-ignore
    const call = writeChangeset.mock.calls[0][0];
    expect(call).toEqual(
      expect.objectContaining({
        summary: "summary message mock",
        releases: [{ name: "single-package", type: "minor" }]
      })
    );
  });

  it("should commit when the commit flag is passed in", async () => {
    const cwd = await f.copy("simple-project-custom-config");

    mockUserResponses({ releases: { "pkg-a": "patch" } });
    await addChangeset(
      cwd,
      { empty: false },
      {
        ...defaultConfig,
        commit: [path.resolve(__dirname, "..", "..", "..", "commit"), null]
      }
    );
    expect(git.add).toHaveBeenCalledTimes(1);
    expect(git.commit).toHaveBeenCalledTimes(1);
  });

  it("should create empty changeset when empty flag is passed in", async () => {
    const cwd = await f.copy("simple-project");

    await addChangeset(cwd, { empty: true }, defaultConfig);

    // @ts-ignore
    const call = writeChangeset.mock.calls[0][0];
    expect(call).toEqual(
      expect.objectContaining({
        releases: [],
        summary: ""
      })
    );
  });

  it("should create changeset with change types per bump type", async () => {
    const cwd = await f.copy("simple-project");
    const [changeTypeAdd, changeTypeChange] = changeTypeList;

    const releases = { "pkg-a": "patch", "pkg-b": "patch" };
    const changeTypes = [changeTypeAdd.title, changeTypeChange.title];
    const providedDescriptions = ["first description", "second description"];

    const bumpTypesAmount = new Set(Object.values(releases)).size;
    const questionsAmount = bumpTypesAmount * changeTypes.length;

    const descriptions = getChangeTypeDescriptions(
      questionsAmount,
      providedDescriptions
    );

    const changeTypesConfig = {
      changeTypes,
      descriptions,
      isSameMsgPerBumpType: true
    };

    mockUserResponses({ releases, changeTypes: changeTypesConfig });
    const config = { ...defaultConfig, shouldAskForChangeTypes: true };
    await addChangeset(cwd, {}, config);

    // @ts-ignore
    const call = writeChangeset.mock.calls[0][0];
    expect(call).toEqual(
      expect.objectContaining({
        releases: [
          {
            changeTypes: [
              {
                category: {
                  text: changeTypeAdd.text,
                  title: changeTypeAdd.title
                },
                description: providedDescriptions[0]
              },
              {
                category: {
                  text: changeTypeChange.text,
                  title: changeTypeChange.title
                },
                description: providedDescriptions[1]
              }
            ],
            name: "pkg-a",
            type: "patch"
          },
          {
            changeTypes: [
              {
                category: {
                  text: changeTypeAdd.text,
                  title: changeTypeAdd.title
                },
                description: providedDescriptions[0]
              },
              {
                category: {
                  text: changeTypeChange.text,
                  title: changeTypeChange.title
                },
                description: providedDescriptions[1]
              }
            ],
            name: "pkg-b",
            type: "patch"
          }
        ],
        summary: "summary message mock"
      })
    );
  });

  it("should create changeset with change types per package", async () => {
    const cwd = await f.copy("simple-project");
    const [changeTypeAdd, changeTypeChange] = changeTypeList;

    const releases = { "pkg-a": "patch", "pkg-b": "patch" };
    const changeTypes = [changeTypeAdd.title, changeTypeChange.title];
    const providedDescriptions = [
      "first description",
      "second description",
      "third description",
      "fourth description"
    ];

    const questionsAmount = Object.keys(releases).length * changeTypes.length;

    const descriptions = getChangeTypeDescriptions(
      questionsAmount,
      providedDescriptions
    );

    const summariesAmount = Object.keys(releases).length;
    const summaries = Array(summariesAmount).fill(MOCK_SUMMARY);
    const changeTypesConfig = {
      summaries,
      changeTypes,
      descriptions,
      isSameMsgPerBumpType: false,
      shouldReusePrevPkgAnswer: false
    };

    mockUserResponses({ releases, changeTypes: changeTypesConfig });
    const config = { ...defaultConfig, shouldAskForChangeTypes: true };
    await addChangeset(cwd, {}, config);

    // @ts-ignore
    const firstCall = writeChangeset.mock.calls[0][0];
    expect(firstCall).toEqual(
      expect.objectContaining({
        releases: [
          {
            changeTypes: [
              {
                category: {
                  text: changeTypeAdd.text,
                  title: changeTypeAdd.title
                },
                description: providedDescriptions[0]
              },
              {
                category: {
                  text: changeTypeChange.text,
                  title: changeTypeChange.title
                },
                description: providedDescriptions[1]
              }
            ],
            name: "pkg-a",
            type: "patch"
          }
        ],
        summary: "summary message mock"
      })
    );
    // @ts-ignore
    const secondCall = writeChangeset.mock.calls[1][0];
    expect(secondCall).toEqual(
      expect.objectContaining({
        releases: [
          {
            changeTypes: [
              {
                category: {
                  text: changeTypeAdd.text,
                  title: changeTypeAdd.title
                },
                description: providedDescriptions[2]
              },
              {
                category: {
                  text: changeTypeChange.text,
                  title: changeTypeChange.title
                },
                description: providedDescriptions[3]
              }
            ],
            name: "pkg-b",
            type: "patch"
          }
        ],
        summary: "summary message mock"
      })
    );
  }); // @TODO
  it("should create changeset with change types for single package", () => {}); // @TODO
});
