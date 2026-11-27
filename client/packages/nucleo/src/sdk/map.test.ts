import type { ServerMember, User } from "stoat.js";
import { describe, expect, it } from "vitest";

import { toMemberSnapshot } from "./map";

function usuario(parcial: Partial<User> = {}): User {
  return {
    id: "01U",
    username: "e",
    displayName: "zola",
    pronouns: undefined,
    status: undefined,
    avatar: undefined,
    avatarURL: undefined,
    ...parcial,
  } as unknown as User;
}

function membro(parcial: Partial<ServerMember> = {}): ServerMember {
  return {
    nickname: null,
    avatar: null,
    avatarURL: undefined,
    roleColour: null,
    hoistedRole: null,
    orderedRoles: [],
    timeout: undefined,
    joinedAt: undefined,
    inferiorTo: () => false,
    ...parcial,
  } as unknown as ServerMember;
}

describe("toMemberSnapshot", () => {
  it("prefere o nome de exibição do usuário ao username quando não há apelido no servidor", () => {
    const snap = toMemberSnapshot(usuario({ username: "e", displayName: "zola" }), membro());
    expect(snap.displayName).toBe("zola");
    expect(snap.username).toBe("e");
  });

  it("prefere o apelido do servidor ao nome de exibição", () => {
    const snap = toMemberSnapshot(
      usuario({ username: "e", displayName: "zola" }),
      membro({ nickname: "Enzo no servidor" }),
    );
    expect(snap.displayName).toBe("Enzo no servidor");
    expect(snap.username).toBe("e");
  });

  it("cai no username quando não há apelido nem nome de exibição", () => {
    const snap = toMemberSnapshot(usuario({ username: "e", displayName: undefined }), membro());
    expect(snap.displayName).toBe("e");
    expect(snap.username).toBe("e");
  });
});
