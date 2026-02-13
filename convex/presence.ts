import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const ONLINE_WINDOW_MS = 30_000; // 30 seconds

export const heartbeat = mutation({
  args: { room: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const room = args.room.trim() || "general";
    const userId = identity.subject;
    const name =
      identity.name || identity.email || identity.nickname || "User";

    const now = Date.now();

    const existing = await ctx.db
      .query("presence")
      .withIndex("by_room_user", (q) =>
        q.eq("room", room).eq("userId", userId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name,
        lastSeen: now,
      });
    } else {
      await ctx.db.insert("presence", {
        room,
        userId,
        name,
        lastSeen: now,
      });
    }
  },
});

export const leave = mutation({
  args: { room: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return;

    const room = args.room.trim() || "general";
    const userId = identity.subject;

    const existing = await ctx.db
      .query("presence")
      .withIndex("by_room_user", (q) =>
        q.eq("room", room).eq("userId", userId)
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

export const listOnlineByRoom = query({
  args: { room: v.string() },
  handler: async (ctx, args) => {
    const room = args.room.trim() || "general";
    const now = Date.now();

    const rows = await ctx.db
      .query("presence")
      .withIndex("by_room", (q) => q.eq("room", room))
      .collect();

    return rows
      .filter((p) => now - p.lastSeen <= ONLINE_WINDOW_MS)
      .map((p) => ({
        userId: p.userId,
        name: p.name,
      }));
  },
});
