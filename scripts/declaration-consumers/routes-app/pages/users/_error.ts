export default function UserError(error: unknown): Node {
  const p = document.createElement('p');
  p.textContent = String(error);
  return p;
}
