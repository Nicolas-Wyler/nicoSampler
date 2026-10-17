export function buildVersion(base, env = process.env, now = Date.now()) {
  const match = /^(\d+)\.(\d+)\.\d+/.exec(base);
  if (!match) throw Error("Invalid base app version");
  if (env.SAMPLER_BUILD_VERSION) {
    if (
      !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(env.SAMPLER_BUILD_VERSION)
    )
      throw Error("Invalid explicit build version");
    return env.SAMPLER_BUILD_VERSION;
  }
  if (env.GITHUB_RUN_NUMBER) {
    if (
      !/^\d+$/.test(env.GITHUB_RUN_NUMBER) ||
      !/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT ?? "1")
    )
      throw Error("Invalid CI build identity");
    const version = `${match[1]}.${match[2]}.${env.GITHUB_RUN_NUMBER}`;
    return Number(env.GITHUB_RUN_ATTEMPT ?? 1) > 1
      ? `${version}+build.${env.GITHUB_RUN_ATTEMPT}`
      : version;
  }
  return `${base.split("-")[0]}-dev.${now}`;
}
