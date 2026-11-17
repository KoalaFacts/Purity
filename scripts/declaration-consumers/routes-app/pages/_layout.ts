// Root layout with a loader: its data type flows through `layouts[0]`.
export async function loader(): Promise<{ user: string | null }> {
  return { user: null };
}

export default function RootLayout(child: () => Node): Node {
  return child();
}
