include $(TOPDIR)/rules.mk

PKG_NAME:=frpc
PKG_VERSION:=0.68.0
PKG_RELEASE:=1

PKG_SOURCE_PROTO:=git
PKG_SOURCE_URL:=https://github.com/fatedier/frp.git
PKG_SOURCE_VERSION:=v$(PKG_VERSION)
PKG_MIRROR_HASH:=skip

PKG_LICENSE:=Apache-2.0
PKG_LICENSE_FILES:=LICENSE

GO_PKG:=github.com/fatedier/frp
GO_PKG_LDFLAGS:=-s -w

include $(INCLUDE_DIR)/package.mk
include $(TOPDIR)/feeds/packages/lang/golang/golang-package.mk

define Package/frpc
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=IP Addresses and Names
  TITLE:=Fast Reverse Proxy Client
  URL:=$(PKG_SOURCE_URL)
  DEPENDS:=$(GO_ARCH_DEPENDS)
endef

define Package/frpc/description
  frpc is the client of frp, a fast reverse proxy.
endef

define Build/Compile
	$(call GoPackage/Build/Compile/Default, \
		GO_PKG_VARS="CGO_ENABLED=0" \
		GO_PKG_LDFLAGS="$(GO_PKG_LDFLAGS)" \
		GO_PKG_TAGS="frpc,noweb" \
		GO_PKG_BUILD_PKG="$(GO_PKG)/cmd/frpc" \
		GO_PKG_OUTPUT_NAME="frpc" \
	)
endef

define Package/frpc/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(GO_PKG_BUILD_BIN_DIR)/frpc $(1)/usr/bin/frpc
endef

$(eval $(call GoPackage,frpc))
$(eval $(call BuildPackage,frpc))
