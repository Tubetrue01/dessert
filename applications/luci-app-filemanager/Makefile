include $(TOPDIR)/rules.mk

LUCI_TITLE:=Simple File Manager with Upload/Install
LUCI_DEPENDS:=+luci-base +luci-compat
LUCI_PKGARCH:=all

PKG_NAME:=luci-app-filemanager

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
