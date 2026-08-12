import { authEnvironmentErrors } from "../src/lib/authEnvContract";

const errors = authEnvironmentErrors(process.env);
if (errors.length) {
  console.error("ARGUS production auth environment is invalid:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
}
