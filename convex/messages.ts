import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const listByRoom = query({
  args: { room: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const room = args.room.trim() || "general";
    const limit = args.limit ?? 50;

    return await ctx.db
      .query("messages")
      .withIndex("by_room", (q) => q.eq("room", room))
      .order("desc")
      .take(limit);
  },
});

export const send = mutation({
  args: { room: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const room = args.room.trim() || "general";
    const body = args.body.trim();
    if (!body) return;

    const authorId = identity.subject;
    const author =
      identity.name || identity.email || identity.nickname || "User";

    await ctx.db.insert("messages", { room, authorId, author, body });
  },
});

export const edit = mutation({
  args: { id: v.id("messages"), body: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const msg = await ctx.db.get(args.id);
    if (!msg) throw new Error("Message not found");

    if (msg.authorId !== identity.subject) {
      throw new Error("Not allowed");
    }

    const body = args.body.trim();
    if (!body) throw new Error("Message cannot be empty");

    await ctx.db.patch(args.id, { body });
  },
});

export const remove = mutation({
  args: { id: v.id("messages") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const msg = await ctx.db.get(args.id);
    if (!msg) return;

    if (msg.authorId !== identity.subject) {
      throw new Error("Not allowed");
    }

    await ctx.db.delete(args.id);
  },
});
