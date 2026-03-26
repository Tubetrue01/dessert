include $(TOPDIR)/rules.mk

LUCI_TITLE:=Simple File Manager with Upload/Install
LUCI_DEPENDS:=+luci-base +luci-compat
LUCI_PKGARCH:=all

PKG_NAME:=luci-app-filemanager
PKG_VERSION:=1.0
PKG_RELEASE:=1

define Package/$(PKG_NAME)/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	chmod +x /usr/libexec/rpcd/*
	exit 0
}
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
