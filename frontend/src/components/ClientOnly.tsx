import { useEffect, useState } from "react";

/**
 * ClientOnly component to prevent SSR for browser-only features.
 * Children will only render on the client side, preventing hydration mismatches.
 */
export function ClientOnly({ children, fallback = null }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (!hasMounted) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
