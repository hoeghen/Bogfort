import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { useAuthUser } from './lib/auth';
import { CompanyProvider } from './lib/company';
import { useProfile } from './lib/data';
import { Indstillinger } from './routes/Indstillinger';
import { Kassekladde } from './routes/Kassekladde';
import { Login } from './routes/Login';
import { Onboarding } from './routes/Onboarding';
import { Posteringer } from './routes/Posteringer';

export function App() {
  const { user, ready } = useAuthUser();
  const profile = useProfile(user?.uid ?? null);

  if (!ready) return <Spinner />;
  if (!user) return <Login />;
  if (profile.loading) return <Spinner />;
  const companyId = profile.data?.activeCompanyId;
  if (!companyId) return <Onboarding />;

  return (
    <BrowserRouter>
      <CompanyProvider uid={user.uid} companyId={companyId}>
        <Layout>
          <Routes>
            <Route path="/" element={<Kassekladde />} />
            <Route path="/posteringer" element={<Posteringer />} />
            <Route path="/indstillinger" element={<Indstillinger />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </CompanyProvider>
    </BrowserRouter>
  );
}
