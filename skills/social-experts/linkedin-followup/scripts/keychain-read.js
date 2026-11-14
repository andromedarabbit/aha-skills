// JXA 전용. CoreFoundation 참조는 NSDictionary·NSData로 사용하기 전에 변환한다.
ObjC.import('Foundation');
ObjC.import('Security');
ObjC.import('LocalAuthentication');
ObjC.import('stdlib');

function run(args = []) {
  try {
    const interactive = args.length === 1 && args[0] === 'authorize';
    if (args.length !== 0 && !interactive) $.exit(1);
    // LAContext만으로는 기존 파일 기반 키체인의 인증 UI를 막을 수 없다.
    if ($.SecKeychainSetUserInteractionAllowed(interactive) !== 0) $.exit(1);
    const context = $.LAContext.alloc.init;
    context.interactionNotAllowed = !interactive;
    const query = $.NSMutableDictionary.alloc.init;
    query.setObjectForKey(ObjC.castRefToObject($.kSecClassGenericPassword), ObjC.castRefToObject($.kSecClass));
    query.setObjectForKey($('Aside Safe Storage'), ObjC.castRefToObject($.kSecAttrService));
    query.setObjectForKey($('Aside'), ObjC.castRefToObject($.kSecAttrAccount));
    query.setObjectForKey(ObjC.castRefToObject($.kCFBooleanTrue), ObjC.castRefToObject($.kSecReturnData));
    query.setObjectForKey(ObjC.castRefToObject($.kSecMatchLimitOne), ObjC.castRefToObject($.kSecMatchLimit));
    query.setObjectForKey(context, ObjC.castRefToObject($.kSecUseAuthenticationContext));
    query.setObjectForKey(ObjC.castRefToObject(interactive ? $.kSecUseAuthenticationUIAllow : $.kSecUseAuthenticationUIFail), ObjC.castRefToObject($.kSecUseAuthenticationUI));
    if (Number(query.count) !== 7) $.exit(1);
    const result = Ref();
    const status = $.SecItemCopyMatching(query, result);
    if (status !== 0 || !result[0]) $.exit(1);
    // 내부 pipe 전용 base64이며 auth 자식은 이 값을 외부 stdout에 반환하지 않는다.
    return ObjC.unwrap(ObjC.castRefToObject(result[0]).base64EncodedStringWithOptions(0));
  } catch (_) {
    $.exit(1);
  }
}
