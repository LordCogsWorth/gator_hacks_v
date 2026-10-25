import { LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from './Button';

/**
 * "Sign out" for the demo: there is no real login, so it just goes back to the home page (where you pick
 * Patient or Care team). `onSignOut` runs first, e.g. to forget the remembered patient.
 */
export function SignOutButton({ onSignOut }: { onSignOut?: () => void }) {
  const navigate = useNavigate();
  return (
    <Button
      variant="secondary"
      icon={<LogOut />}
      aria-label="Sign out"
      className="px-3 sm:px-4"
      onClick={() => {
        onSignOut?.();
        navigate('/');
      }}
    >
      <span className="hidden sm:inline">Sign out</span>
    </Button>
  );
}
