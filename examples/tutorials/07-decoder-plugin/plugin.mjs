// #region plugin
// A decoder plugin: `match` picks the events it understands, `describe` turns
// the raw topics/data into a sentence. Keep plugins pure — no I/O.
export default {
  name: "lottery",
  match: (ev) => ev.topics?.[0] === "ticket_purchased",
  describe(ev) {
    const [, buyer] = ev.topics;
    const { amount, numbers } = ev.data;
    const xlm = (BigInt(amount) / 10_000_000n).toString();
    return `${buyer.slice(0, 6)}…${buyer.slice(-4)} bought lottery ticket (numbers: ${numbers.join(", ")}) for ${xlm} XLM`;
  },
};
// #endregion plugin
