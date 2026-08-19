import { createRoot } from 'react-dom/client';
import { setBaseUrl } from '@workspace/api-client-react';

import App from './App';
import { applyBrandingToDocument } from '@/lib/branding';

import './index.css';

applyBrandingToDocument();
setBaseUrl((import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || null);

createRoot(document.getElementById('root')!).render(<App />);
