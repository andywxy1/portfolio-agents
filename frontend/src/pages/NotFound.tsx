import { Link } from 'react-router-dom';
import { usePageTitle } from '../hooks/usePageTitle';

export default function NotFound() {
  usePageTitle('Page Not Found');

  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <p className="text-6xl font-bold text-gray-300">404</p>
      <h1 className="mt-4 text-xl font-semibold text-gray-900">Page not found</h1>
      <p className="mt-2 text-sm text-gray-500">
        The page you are looking for does not exist or has been moved.
      </p>
      <Link
        to="/"
        className="mt-6 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 transition-colors"
      >
        Go to Dashboard
      </Link>
    </div>
  );
}
