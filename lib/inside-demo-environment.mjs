export function isInsideDemoEnvironment(environment = process.env) {
  return environment.RUVANAS_ENVIRONMENT === "DEMO";
}
