import Link from 'next/link'
import { ClipboardList, PackagePlus, Users } from 'lucide-react'

const navItems = [
  { href: '/clientes', label: 'Clientes', icon: Users },
  { href: '/produtos/novo', label: 'Novo Produto', icon: PackagePlus },
  { href: '/publicacoes', label: 'Publicações', icon: ClipboardList },
]

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

        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon

            return (
              <Link
                key={item.href}
                href={item.href}
                className="nav-link"
              >
                <Icon />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </aside>

      <main className="content">{children}</main>
    </div>
  )
}
