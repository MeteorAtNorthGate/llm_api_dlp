/** Spinner component — loading indicator. */

export default function Spinner({ size = 'md', className = '' }) {
  const sizes = {
    sm: 'loading-sm',
    md: 'loading-md',
    lg: 'loading-lg',
  };

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <span className={`loading loading-spinner ${sizes[size] || sizes.md}`} />
    </div>
  );
}
