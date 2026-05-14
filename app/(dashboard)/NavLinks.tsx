'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ClipboardList, Package, PackagePlus, Users } from 'lucide-react'

const navItems = [
  { href: '/clientes', label: 'Clientes', icon: Users },
  { href: '/produtos', label: 'Produtos', icon: Package },
  { href: '/produtos/novo', label: 'Novo Produto', icon: PackagePlus },
  { href: '/publicacoes', label: 'Publicacoes', icon: ClipboardList },
]

export function NavLinks() {
  const pathname = usePathname()

  return (
    <nav className="nav-list">
      {navItems.map((item) => {
        const Icon = item.icon
        const active = item.href === '/produtos' ? pathname === '/produtos' : pathname.startsWith(item.href)

        return (
          <Link key={item.href} href={item.href} className={`nav-link ${active ? 'nav-link-active' : ''}`}>
            <Icon />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
