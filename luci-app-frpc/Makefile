include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI app for frpc
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all

PKG_NAME:=luci-app-frpc
PKG_VERSION:=1.0
PKG_RELEASE:=3

define Package/$(PKG_NAME)/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -rf /tmp/luci-indexcache /tmp/luci-modulecache/
	/etc/init.d/rpcd restart
	exit 0
}
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
