/**
 * Splits the words of a heading (or one line of it) into masked spans for the word reveal
 * (design.md recipe 7.1). The heading keeps its text as an `aria-label` and the word spans are
 * `aria-hidden`, so a screen reader reads the heading once, whole. Splitting twice is a no op.
 */
export function splitWords(root: HTMLElement): NodeListOf<HTMLElement> {
  if (root.dataset.split) return root.querySelectorAll<HTMLElement>(".h-w");
  const heading = root.closest("h1, h2, h3");
  if (heading && !heading.hasAttribute("aria-label")) {
    heading.setAttribute("aria-label", (heading.textContent ?? "").trim().replace(/\s+/g, " "));
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const fragment = document.createDocumentFragment();
    for (const part of (node.textContent ?? "").split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        fragment.append(" ");
        continue;
      }
      const mask = document.createElement("span");
      mask.className = "h-w-mask";
      mask.setAttribute("aria-hidden", "true");
      const word = document.createElement("span");
      word.className = "h-w";
      word.textContent = part;
      mask.append(word);
      fragment.append(mask);
    }
    node.replaceWith(fragment);
  }
  root.dataset.split = "1";
  return root.querySelectorAll<HTMLElement>(".h-w");
}
