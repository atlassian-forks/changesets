module.exports = {
  changelog: [
    "@changesets/changelog-github",
    { repo: "changesets/changesets" }
  ],
  getBaseBranch: () => "main",
  commit: false,
  access: "public",
  ___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH: {
    updateInternalDependents: "always"
  }
};
