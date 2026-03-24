import { useEffect } from 'react';

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} | Portfolio Agents`;
    return () => {
      document.title = 'Portfolio Agents';
    };
  }, [title]);
}
