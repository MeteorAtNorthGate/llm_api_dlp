/** Button component — thin wrapper with loading state. */

export default function Button({
  children,
  className = '',
  isLoading = false,
  disabled = false,
  variant = 'primary',
  ...props
}) {
  const variants = {
    primary: 'btn-primary',
    secondary: 'btn-outline',
    ghost: 'btn-ghost',
    danger: 'btn-error',
  };

  return (
    <button
      className={`btn ${variants[variant] || 'btn-primary'} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && <span className="loading loading-spinner loading-sm" />}
      {children}
    </button>
  );
}
