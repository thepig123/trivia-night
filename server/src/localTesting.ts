export function localTestingAllowed(address: string | undefined, environment = process.env.NODE_ENV): boolean {
  return environment !== "production" && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address ?? "");
}
