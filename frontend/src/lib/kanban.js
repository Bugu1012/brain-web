export function parseKanban(text) {
  const lines = text.split("\n");
  let i = 0;
  let frontmatter = "";
  if (lines[0] && lines[0].trim() === "---") {
    let j = 1;
    while (j < lines.length && lines[j].trim() !== "---") j++;
    frontmatter = lines.slice(0, j + 1).join("\n");
    i = j + 1;
  }
  const sections = [];
  let current = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const h = line.match(/^##\s+(.+?)\s*$/);
    const card = line.match(/^-\s+\[( |x|X)\]\s+(.*)$/);
    if (h) {
      current = { name: h[1], prefix: [], cards: [] };
      sections.push(current);
    } else if (current && card) {
      current.cards.push({ done: card[1].toLowerCase() === "x", text: card[2] });
    } else if (current) {
      const lastCard = current.cards[current.cards.length - 1];
      if (lastCard) {
        if (!lastCard.body) lastCard.body = [];
        lastCard.body.push(line);
      } else {
        current.prefix.push(line);
      }
    }
  }
  return { frontmatter, sections };
}

export function serializeKanban(board) {
  const parts = (board.frontmatter || "---\nkanban-plugin: basic\n---").split("\n");
  for (const s of board.sections) {
    if (parts.length && parts[parts.length - 1] !== "") parts.push("");
    parts.push("## " + s.name);
    if (s.prefix && s.prefix.length) parts.push(...s.prefix);
    for (const c of s.cards) {
      parts.push("- [" + (c.done ? "x" : " ") + "] " + c.text);
      if (c.body && c.body.length) parts.push(...c.body);
    }
  }
  return parts.join("\n");
}

export function moveCard(board, fromCol, fromIdx, toCol, toIdx) {
  const src = board.sections.find((s) => s.name === fromCol);
  const dst = board.sections.find((s) => s.name === toCol);
  if (!src || !dst) return board;
  const [card] = src.cards.splice(fromIdx, 1);
  if (!card) return board;
  dst.cards.splice(toIdx, 0, card);
  return board;
}

export function dueDate(text) {
  const m = text.match(/📅\s*(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}
