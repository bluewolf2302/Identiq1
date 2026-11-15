import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Organisation Membership Security Contract", () => {
  const VALID_ROLES = ["owner", "admin", "reviewer", "contributor"] as const;
  type Role = (typeof VALID_ROLES)[number];

  it("strictly defines the 4-role hierarchy without mixing member/viewer", () => {
    assert.deepEqual(VALID_ROLES, ["owner", "admin", "reviewer", "contributor"]);
  });

  describe("Role Management Authorization Matrix", () => {
    function canManageRole(
      callerRole: Role,
      targetCurrentRole: Role | null,
      targetNewRole: Role | null
    ): boolean {
      // 1. Only owners can assign or promote to 'owner' or 'admin'
      if (targetNewRole === "owner" || targetNewRole === "admin") {
        return callerRole === "owner";
      }

      // 2. Admins can manage reviewer and contributor roles
      if (callerRole === "admin") {
        if (targetCurrentRole === "owner" || targetCurrentRole === "admin") {
          return false; // Admin cannot modify or delete owner or admin
        }
        return true;
      }

      // 3. Owners can manage everything
      if (callerRole === "owner") {
        return true;
      }

      // 4. Reviewers and contributors cannot manage membership
      return false;
    }

    it("allows owners to assign any role", () => {
      assert.ok(canManageRole("owner", null, "owner"));
      assert.ok(canManageRole("owner", null, "admin"));
      assert.ok(canManageRole("owner", null, "reviewer"));
      assert.ok(canManageRole("owner", null, "contributor"));
    });

    it("prohibits admins from promoting anyone to owner or admin", () => {
      assert.equal(canManageRole("admin", "reviewer", "owner"), false);
      assert.equal(canManageRole("admin", "reviewer", "admin"), false);
    });

    it("allows admins to manage reviewer and contributor roles", () => {
      assert.ok(canManageRole("admin", null, "reviewer"));
      assert.ok(canManageRole("admin", null, "contributor"));
      assert.ok(canManageRole("admin", "contributor", "reviewer"));
    });

    it("prohibits reviewers and contributors from managing any membership", () => {
      assert.equal(canManageRole("reviewer", null, "contributor"), false);
      assert.equal(canManageRole("contributor", null, "contributor"), false);
    });

    it("prohibits admins from demoting or removing owners or other admins", () => {
      assert.equal(canManageRole("admin", "owner", "reviewer"), false);
      assert.equal(canManageRole("admin", "admin", "reviewer"), false);
    });
  });

  describe("Anti-Self-Role Modification Invariant", () => {
    function canModifyOwnRole(
      callerId: string,
      targetUserId: string,
      currentRole: Role,
      newRole: Role
    ): boolean {
      if (callerId === targetUserId && currentRole !== newRole) {
        return false; // Users cannot alter their own role
      }
      return true;
    }

    it("strictly rejects any user trying to change their own role", () => {
      assert.equal(canModifyOwnRole("u-admin", "u-admin", "admin", "owner"), false);
      assert.equal(canModifyOwnRole("u-rev", "u-rev", "reviewer", "admin"), false);
      assert.equal(canModifyOwnRole("u-owner", "u-owner", "owner", "admin"), false);
    });

    it("permits role changes when executed by a different authorized caller", () => {
      assert.equal(canModifyOwnRole("u-owner", "u-admin", "admin", "owner"), true);
    });
  });

  describe("Sole Owner Departure Invariant", () => {
    function canRemoveOwner(
      totalOwnersInOrg: number,
      targetRole: Role
    ): { allowed: boolean; reason?: string } {
      if (targetRole === "owner" && totalOwnersInOrg <= 1) {
        return {
          allowed: false,
          reason: "Cannot demote or remove the sole owner of an organisation",
        };
      }
      return { allowed: true };
    }

    it("rejects sole owner removal or demotion when owner count is 1", () => {
      const result = canRemoveOwner(1, "owner");
      assert.equal(result.allowed, false);
      assert.equal(result.reason, "Cannot demote or remove the sole owner of an organisation");
    });

    it("permits owner departure when second owner exists (owner count > 1)", () => {
      const result = canRemoveOwner(2, "owner");
      assert.equal(result.allowed, true);
    });

    it("permits non-owner removal regardless of owner count", () => {
      const result = canRemoveOwner(1, "admin");
      assert.equal(result.allowed, true);
    });
  });
});
