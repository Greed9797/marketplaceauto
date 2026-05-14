import { NavLinks } from './NavLinks'

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">MP</div>
          <div>
            <p className="brand-title">Marketplace Publisher</p>
            <p className="brand-subtitle">Mercado Livre e Shopee</p>
          </div>
        </div>

        <NavLinks />
      </aside>

      <main className="content">{children}</main>
    </div>
  )
}
