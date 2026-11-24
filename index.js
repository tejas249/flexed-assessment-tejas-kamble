const express = require("express");
const { randomUUID } = require("crypto");

const app = express();
app.use(express.json());

// In-memory data
const users = [
  { id: "u1", name: "Asha", credits: 3 },
  { id: "u2", name: "Ravi", credits: 0 },
];

const venues = [
  { id: "v1", name: "Iron Gym", pricePerVisit: 500, dailyCapacity: 2 },
  { id: "v2", name: "Yoga Studio", pricePerVisit: 300, dailyCapacity: 10 },
];

const bookings = [];

// GET /users/:id - user plus their bookings
app.get("/users/:id", (req, res) => {
  const user = users.find((u) => u.id === req.params.id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  const userBookings = bookings.filter((b) => b.userId === user.id);
  res.json({ ...user, bookings: userBookings });
});

// Random unique 6 character uppercase code
function generateCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (bookings.some((b) => b.code === code));
  return code;
}

// POST /bookings - book a visit (costs 1 credit)
app.post("/bookings", (req, res) => {
  const { userId, venueId } = req.body || {};

  // All checks first, no data changes until they all pass
  if (!userId || !venueId) {
    return res.status(400).json({ error: "userId and venueId are required" });
  }

  const user = users.find((u) => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const venue = venues.find((v) => v.id === venueId);
  if (!venue) {
    return res.status(404).json({ error: "Venue not found" });
  }

  if (user.credits <= 0) {
    return res.status(400).json({ error: "Not enough credits" });
  }

  const today = new Date().toISOString().slice(0, 10);
  const bookedToday = bookings.filter(
    (b) => b.venueId === venue.id && b.createdAt.slice(0, 10) === today
  ).length;
  if (bookedToday >= venue.dailyCapacity) {
    return res.status(409).json({ error: "Venue is fully booked for today" });
  }

  // Everything is valid: deduct credit and create the booking
  user.credits -= 1;

  const booking = {
    id: randomUUID(),
    userId: user.id,
    venueId: venue.id,
    code: generateCode(),
    status: "confirmed",
    createdAt: new Date().toISOString(),
    redeemedAt: null,
  };
  bookings.push(booking);

  res.status(201).json(booking);
});

// POST /booking/redeem - redeem a booking by its code
app.post("/booking/redeem", (req, res) => {
  const { code } = req.body || {};

  if (!code) {
    return res.status(400).json({ error: "code is required" });
  }

  const booking = bookings.find((b) => b.code === code);
  if (!booking) {
    return res.status(404).json({ error: "Booking not found" });
  }

  if (booking.status === "redeemed") {
    return res.status(409).json({ error: "Booking already redeemed" });
  }

  booking.status = "redeemed";
  booking.redeemedAt = new Date().toISOString();

  res.status(200).json(booking);
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
