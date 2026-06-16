include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI app for adguardhome

PKG_NAME:=luci-app-adguardhome
PKG_VERSION:=1.0
PKG_RELEASE:=3

LUCI_DEPENDS:=+yq +luci-base
LUCI_PKGARCH:=all

define Package/$(PKG_NAME)/conffiles
/etc/config/AdGuardHome
/etc/AdGuardHome/AdGuardHome.yaml
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
