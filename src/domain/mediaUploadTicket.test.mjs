import test from "node:test";
import assert from "node:assert/strict";
import { isPrivateMediaLocator, validMediaUploadTicket } from "./mediaUploadTicket.mjs";

const headers = { "Content-Type": "image/jpeg", "If-None-Match": "*" };

test("accepts a bound public upload ticket", () => {
  assert.equal(validMediaUploadTicket({
    uploadUrl: "https://storage.example/bucket/key?signature=one",
    publicUrl: "https://media.example/users/u_one/post/file.jpg",
    storageLocator: "https://media.example/users/u_one/post/file.jpg",
    storageScope: "public",
    method: "PUT",
    requiredHeaders: headers,
  }), true);
});

test("accepts an explicit private source ticket without a public URL", () => {
  assert.equal(validMediaUploadTicket({
    uploadUrl: "https://storage.example/private/key?signature=one",
    publicUrl: null,
    storageLocator: "pit-private:users/u_one/post/source_123.heic",
    storageScope: "private",
    method: "PUT",
    requiredHeaders: headers,
  }), true);
});

test("rejects scope confusion and noncanonical private locators", () => {
  assert.equal(validMediaUploadTicket({
    uploadUrl: "https://storage.example/key",
    publicUrl: "https://media.example/leaked.jpg",
    storageLocator: "pit-private:users/u_one/post/source.jpg",
    storageScope: "private",
    requiredHeaders: headers,
  }), false);
  assert.equal(isPrivateMediaLocator("pit-private:users/u_one/post/../../secret.jpg"), false);
  assert.equal(isPrivateMediaLocator("https://attacker.example/private.jpg"), false);
});

test("rejects unsigned overwrite and non-HTTP upload capabilities", () => {
  assert.equal(validMediaUploadTicket({
    uploadUrl: "javascript:alert(1)",
    publicUrl: null,
    storageLocator: "pit-private:users/u_one/post/source.jpg",
    storageScope: "private",
    requiredHeaders: { "Content-Type": "image/jpeg" },
  }), false);
});
