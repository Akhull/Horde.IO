// Winziger DOM-Helfer: deklaratives Erzeugen von Elementen ohne Framework.
type Props<E extends HTMLElement> = Partial<Omit<E, "style" | "dataset" | "children">> & {
  class?: string;
  style?: Partial<CSSStyleDeclaration>;
  dataset?: Record<string, string>;
  html?: string;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: className, style, dataset, html, ...rest } = props;
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  if (style) Object.assign(node.style, style);
  if (dataset) for (const [k, v] of Object.entries(dataset)) node.dataset[k] = v;
  Object.assign(node, rest);
  for (const c of children) node.append(c);
  return node;
}
