/** NotFoundPage — 404 page. */

import { Link } from 'react-router-dom';
import useT from '../hooks/useT';

export default function NotFoundPage() {
  const t = useT();
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center space-y-4">
        <h1 className="text-6xl font-bold text-base-content/30">404</h1>
        <p className="text-xl text-base-content/60">{t('notFound.title')}</p>
        <Link to="/" className="btn btn-primary">
          {t('notFound.goHome')}
        </Link>
      </div>
    </div>
  );
}
