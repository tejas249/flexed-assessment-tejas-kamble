const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

// Load a fresh copy of the app (with fresh seed data) for every test
let server;
let baseUrl;

beforeEach(async () => {
  delete require.cache[require.resolve("./index.js")];
  const app = require("./index.js");
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://localhost:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function request(method, path, body) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const getUser = (id) => request("GET", `/users/${id}`);
const book = (userId, venueId) => request("POST", "/bookings", { userId, venueId });
const redeem = (code) => request("POST", "/booking/redeem", { code });

describe("GET /users/:id", () => {
  test("returns the user with an empty bookings array", async () => {
    const res = await getUser("u1");
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { id: "u1", name: "Asha", credits: 3, bookings: [] });
  });

  test("returns 404 when the user does not exist", async () => {
    const res = await getUser("nope");
    assert.strictEqual(res.status, 404);
    assert.deepStrictEqual(res.body, { error: "User not found" });
  });

  test("includes only that user's bookings", async () => {
    await book("u1", "v1");
    const res = await getUser("u1");
    assert.strictEqual(res.body.bookings.length, 1);
    assert.strictEqual(res.body.bookings[0].userId, "u1");

    const other = await getUser("u2");
    assert.deepStrictEqual(other.body.bookings, []);
  });
});

describe("POST /bookings", () => {
  test("returns 400 when userId is missing", async () => {
    const res = await request("POST", "/bookings", { venueId: "v1" });
    assert.strictEqual(res.status, 400);
  });

  test("returns 400 when venueId is missing", async () => {
    const res = await request("POST", "/bookings", { userId: "u1" });
    assert.strictEqual(res.status, 400);
  });

  test("returns 400 when the body is empty", async () => {
    const res = await request("POST", "/bookings", {});
    assert.strictEqual(res.status, 400);
  });

  test("returns 404 when the user does not exist", async () => {
    const res = await book("nope", "v1");
    assert.strictEqual(res.status, 404);
    assert.deepStrictEqual(res.body, { error: "User not found" });
  });

  test("returns 404 when the venue does not exist", async () => {
    const res = await book("u1", "nope");
    assert.strictEqual(res.status, 404);
    assert.deepStrictEqual(res.body, { error: "Venue not found" });
  });

  test("returns 400 when the user has 0 credits", async () => {
    const res = await book("u2", "v1");
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: "Not enough credits" });
  });

  test("user check comes before venue check (missing both -> user 404)", async () => {
    const res = await book("nope", "nope");
    assert.deepStrictEqual(res.body, { error: "User not found" });
  });

  test("returns 201 with the booking and deducts 1 credit", async () => {
    const res = await book("u1", "v1");
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.userId, "u1");
    assert.strictEqual(res.body.venueId, "v1");
    assert.strictEqual(res.body.status, "confirmed");
    assert.strictEqual(res.body.redeemedAt, null);
    assert.ok(res.body.id);
    assert.ok(!Number.isNaN(Date.parse(res.body.createdAt)));
    assert.match(res.body.code, /^[A-Z0-9]{6}$/);

    const user = await getUser("u1");
    assert.strictEqual(user.body.credits, 2);
  });

  test("generates unique codes", async () => {
    const a = await book("u1", "v2");
    const b = await book("u1", "v2");
    assert.notStrictEqual(a.body.code, b.body.code);
  });

  test("returns 409 when the venue is at daily capacity", async () => {
    assert.strictEqual((await book("u1", "v1")).status, 201);
    assert.strictEqual((await book("u1", "v1")).status, 201);
    const res = await book("u1", "v1");
    assert.strictEqual(res.status, 409);
    assert.deepStrictEqual(res.body, { error: "Venue is fully booked for today" });
  });

  test("a failed booking does not deduct a credit", async () => {
    await book("u1", "v1");
    await book("u1", "v1");
    await book("u1", "v1"); // 409
    await book("u2", "v2"); // 400
    const asha = await getUser("u1");
    assert.strictEqual(asha.body.credits, 1);
    assert.strictEqual(asha.body.bookings.length, 2);
    const ravi = await getUser("u2");
    assert.strictEqual(ravi.body.credits, 0);
  });

  test("capacity is tracked per venue", async () => {
    await book("u1", "v1");
    await book("u1", "v1");
    // Iron Gym is full but Yoga Studio still has room (Asha has 1 credit left)
    const res = await book("u1", "v2");
    assert.strictEqual(res.status, 201);
  });

  test("returns 400 when credits run out", async () => {
    await book("u1", "v2");
    await book("u1", "v2");
    await book("u1", "v2");
    const res = await book("u1", "v2");
    assert.strictEqual(res.status, 400);
  });
});

describe("POST /booking/redeem", () => {
  test("returns 400 when code is missing", async () => {
    const res = await request("POST", "/booking/redeem", {});
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: "code is required" });
  });

  test("returns 404 when the code does not exist", async () => {
    const res = await redeem("ZZZZZZ");
    assert.strictEqual(res.status, 404);
    assert.deepStrictEqual(res.body, { error: "Booking not found" });
  });

  test("returns 200 and marks the booking redeemed", async () => {
    const created = await book("u1", "v1");
    const res = await redeem(created.body.code);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, created.body.id);
    assert.strictEqual(res.body.status, "redeemed");
    assert.ok(!Number.isNaN(Date.parse(res.body.redeemedAt)));
  });

  test("redeemed state shows up on the user's bookings", async () => {
    const created = await book("u1", "v1");
    await redeem(created.body.code);
    const user = await getUser("u1");
    assert.strictEqual(user.body.bookings[0].status, "redeemed");
    assert.ok(user.body.bookings[0].redeemedAt);
  });

  test("returns 409 when already redeemed", async () => {
    const created = await book("u1", "v1");
    await redeem(created.body.code);
    const res = await redeem(created.body.code);
    assert.strictEqual(res.status, 409);
    assert.deepStrictEqual(res.body, { error: "Booking already redeemed" });
  });

  test("redeeming does not change credits", async () => {
    const created = await book("u1", "v1");
    await redeem(created.body.code);
    const user = await getUser("u1");
    assert.strictEqual(user.body.credits, 2);
  });
});
