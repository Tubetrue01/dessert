include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI app for frpc

PKG_NAME:=luci-app-frpc

LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all

define Package/$(PKG_NAME)/conffiles
/etc/config/frpc
/etc/frpc/frpc.yaml
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
