import { readFileSync } from "node:fs";

interface PackageMetadata {
  name: string;
  version: string;
  description: string;
}

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
) as PackageMetadata;

export const PACKAGE_NAME = packageJson.name;
export const PACKAGE_VERSION = packageJson.version;
export const PACKAGE_DESCRIPTION = packageJson.description;
