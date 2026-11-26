import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPrivateAddress } from "../src/ssrf";

describe("isPrivateAddress", () => {
  it("refuse boucle locale, réseaux privés, link-local (métadonnées cloud), CGNAT, multicast", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
  });
  it("accepte des adresses publiques", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("refuse ce qui n'est pas une IP", () => expect(isPrivateAddress("pas-une-ip")).toBe(true));
});

describe("assertPublicUrl", () => {
  const dns = (m: Record<string, string[]>) => async (h: string) => m[h] ?? [];
  it("accepte un domaine public", async () => {
    await expect(assertPublicUrl("https://exemple.com/x", dns({ "exemple.com": ["93.184.216.34"] }))).resolves.toBeUndefined();
  });
  it("refuse un domaine qui résout vers une IP privée (rebinding) ou n'importe laquelle des IP", async () => {
    await expect(assertPublicUrl("https://evil.test", dns({ "evil.test": ["127.0.0.1"] }))).rejects.toThrow("non publique");
    await expect(assertPublicUrl("https://mix.test", dns({ "mix.test": ["8.8.8.8", "10.0.0.1"] }))).rejects.toThrow("non publique");
  });
  it("refuse IP littérale privée, protocoles exotiques, identifiants, hôte non résolu", async () => {
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow();
    await expect(assertPublicUrl("http://[::1]:8080/")).rejects.toThrow();
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow("protocole");
    await expect(assertPublicUrl("https://u:p@exemple.com", dns({ "exemple.com": ["93.184.216.34"] }))).rejects.toThrow("identifiants");
    await expect(assertPublicUrl("https://inconnu.test", dns({}))).rejects.toThrow("non résolu");
  });
});
