include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for Turbo ACC (Modern ucode version)

PKG_NAME:=luci-app-turboacc
PKG_VERSION:=1.0
PKG_RELEASE:=1

LUCI_DEPENDS:= \
    +luci-base \
    +kmod-tcp-bbr \
    +kmod-nft-offload \
    +kmod-nft-fullcone \
    +PACKAGE_$(PKG_NAME)_INCLUDE_SHORTCUT_FE:kmod-shortcut-fe-cm

LUCI_PKGARCH:=all


define Package/$(PKG_NAME)/config
config PACKAGE_$(PKG_NAME)_INCLUDE_SHORTCUT_FE
	bool "Include Shortcut-FE (SFE)"
	default n
	help
	  Enable this if you want SFE support. Note that it might conflict with Flow Offloading.
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
