// Local integration fixture: real customer page; authentication is supplied by the isolated test server.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CustomerProfilePage from '../../src/pages/CustomerProfilePage';

createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/wechat/crm/合成客户?cs=cs-a']}>
    <Routes><Route path="/wechat/crm/:contactKey" element={<CustomerProfilePage />} /></Routes>
  </MemoryRouter>,
);
