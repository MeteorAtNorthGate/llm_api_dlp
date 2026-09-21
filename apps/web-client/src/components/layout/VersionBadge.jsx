/** VersionBadge — 右下角显示当前部署的 git 短哈希，用来确认部署版本。 */

import useT from '../../hooks/useT';

export default function VersionBadge() {
  const t = useT();
  // 由 deploy.sh / deploy_web.sh 在构建前写进 apps/web-client/.env.local
  // （VITE_GIT_HASH=<git rev-parse --short HEAD>），vite 构建时把它 inline 进产物。
  // 本地 dev 没有这个文件，退化成 dev。
  const hash = import.meta.env.VITE_GIT_HASH || 'dev';

  return (
    <div
      className="fixed bottom-1 right-2 z-50 font-mono text-[10px] leading-none
                 text-base-content/30 hover:text-base-content/70 transition-colors
                 select-none cursor-default"
      title={t('app.version')}
    >
      {hash}
    </div>
  );
}
