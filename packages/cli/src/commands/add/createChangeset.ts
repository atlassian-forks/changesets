import chalk from "chalk";

import semver from "semver";

import * as cli from "../../utils/cli-utilities";
import { error, log } from "@changesets/logger";
import { Release, PackageJSON, VersionType } from "@changesets/types";
import { Package } from "@manypkg/get-packages";
import { ExitError } from "@changesets/errors";

const { green, yellow, red, bold, blue, cyan, gray } = chalk;

type PackageNameJsonMap = Map<string, PackageJSON>;

async function confirmMajorRelease(pkgJSON: PackageJSON) {
  if (semver.lt(pkgJSON.version, "1.0.0")) {
    // prettier-ignore
    log(yellow(`WARNING: Releasing a major version for ${green(pkgJSON.name)} will be its ${red('first major release')}.`))
    log(
      yellow(
        `If you are unsure if this is correct, contact the package's maintainers ${red(
          "before committing this changeset"
        )}.`
      )
    );

    let shouldReleaseFirstMajor = await cli.askConfirm(
      bold(
        `Are you sure you want to release the ${red(
          "first major version"
        )} of ${pkgJSON.name}?`
      )
    );
    return shouldReleaseFirstMajor;
  }
  return true;
}

async function getPackagesToRelease(
  changedPackages: Array<string>,
  allPackages: Array<Package>
) {
  function askInitialReleaseQuestion(defaultChoiceList: Array<any>) {
    return cli.askCheckboxPlus(
      // TODO: Make this wording better
      // TODO: take objects and be fancy with matching
      `Which packages would you like to include?`,
      defaultChoiceList,
      x => {
        // this removes changed packages and unchanged packages from the list
        // of packages shown after selection
        if (Array.isArray(x)) {
          return x
            .filter(x => x !== "changed packages" && x !== "unchanged packages")
            .map(x => cyan(x))
            .join(", ");
        }
        return x;
      }
    );
  }

  if (allPackages.length > 1) {
    const unchangedPackagesNames = allPackages
      .map(({ packageJson }) => packageJson.name)
      .filter(name => !changedPackages.includes(name));

    const defaultChoiceList = [
      {
        name: "changed packages",
        choices: changedPackages
      },
      {
        name: "unchanged packages",
        choices: unchangedPackagesNames
      }
    ].filter(({ choices }) => choices.length !== 0);

    let packagesToRelease = await askInitialReleaseQuestion(defaultChoiceList);

    if (packagesToRelease.length === 0) {
      do {
        error("You must select at least one package to release");
        error("(You most likely hit enter instead of space!)");

        packagesToRelease = await askInitialReleaseQuestion(defaultChoiceList);
      } while (packagesToRelease.length === 0);
    }
    return packagesToRelease.filter(
      pkgName =>
        pkgName !== "changed packages" && pkgName !== "unchanged packages"
    );
  }
  return [allPackages[0].packageJson.name];
}

export function formatPkgNameAndVersion(pkgName: string, version: string) {
  return `${bold(pkgName)}@${bold(version)}`;
}

function getBumpTypeTitle(bumpType: VersionType) {
  return `Which packages should have a ${bumpType} bump?`;
}

const bumpTypes: { type: VersionType; title: VersionType }[] = [
  { type: "major", title: red("major") as VersionType },
  { type: "minor", title: green("minor") as VersionType },
  { type: "patch", title: blue("patch") as VersionType },
  { type: "none", title: gray("none") as VersionType }
];

export async function choosePkgsForBumpType(
  title: string,
  packages: string[],
  pkgJsonsByName: PackageNameJsonMap
) {
  const choices = packages.map(pkgName => ({
    name: pkgName,
    message: formatPkgNameAndVersion(
      pkgName,
      pkgJsonsByName.get(pkgName)!.version
    )
  }));

  return (
    await cli.askCheckboxPlus(
      bold(title),
      [{ choices, name: "all packages" }],
      x => {
        // this removes changed packages and unchanged packages from the list
        // of packages shown after selection
        if (Array.isArray(x)) {
          return x
            .filter(x => x !== "all packages")
            .map(x => cyan(x))
            .join(", ");
        }
        return x;
      }
    )
  ).filter(x => x !== "all packages");
}

function logRestWillBeBumped(
  bumpType: VersionType,
  packages: string[],
  pkgJsonsByName: PackageNameJsonMap
) {
  log(`The following packages will be ${bumpType} bumped:`);
  packages.forEach(pkgName => {
    log(formatPkgNameAndVersion(pkgName, pkgJsonsByName.get(pkgName)!.version));
  });
}

export default async function createChangeset(
  changedPackages: Array<string>,
  allPackages: Package[]
): Promise<{ confirmed: boolean; summary: string; releases: Array<Release> }> {
  const releases: Array<Release> = [];

  if (allPackages.length > 1) {
    const packagesToRelease = await getPackagesToRelease(
      changedPackages,
      allPackages
    );

    let pkgJsonsByName: PackageNameJsonMap = new Map(
      allPackages.map(({ packageJson }) => [packageJson.name, packageJson])
    );

    let pkgsLeftToGetBumpTypeFor = new Set(packagesToRelease);

    for (const [i, bump] of bumpTypes.entries()) {
      const packages = [...pkgsLeftToGetBumpTypeFor];
      const isLast = i === bumpTypes.length - 1;
      let pkgsForThisBumpType: string[] = [];

      if (!packages.length) break;

      if (isLast) {
        const bumpType = blue(bump.title) as VersionType;
        logRestWillBeBumped(bumpType, packages, pkgJsonsByName);
        pkgsForThisBumpType = packages;
      } else {
        pkgsForThisBumpType = await choosePkgsForBumpType(
          getBumpTypeTitle(bump.title),
          packages,
          pkgJsonsByName
        );
      }

      for (const pkgName of pkgsForThisBumpType) {
        if (bump.type === "major") {
          const pkgJson = pkgJsonsByName.get(pkgName)!;
          const shouldReleaseFirstMajor = await confirmMajorRelease(pkgJson);
          if (!shouldReleaseFirstMajor) continue;
        }

        pkgsLeftToGetBumpTypeFor.delete(pkgName);
        releases.push({ name: pkgName, type: bump.type });
      }
    }
  } else {
    let pkg = allPackages[0];
    let type = await cli.askList(
      `What kind of change is this for ${green(
        pkg.packageJson.name
      )}? (current version is ${pkg.packageJson.version})`,
      ["patch", "minor", "major"]
    );
    if (type === "major") {
      let shouldReleaseAsMajor = await confirmMajorRelease(pkg.packageJson);
      if (!shouldReleaseAsMajor) {
        throw new ExitError(1);
      }
    }
    releases.push({ name: pkg.packageJson.name, type });
  }

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
        return {
          confirmed: true,
          summary,
          releases
        };
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

  return {
    confirmed: false,
    summary,
    releases
  };
}
