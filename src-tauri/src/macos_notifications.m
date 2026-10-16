#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#import <dispatch/dispatch.h>

// Keep the delegate for the process lifetime. userInfo belongs to the delivered
// system notification, so a click after relaunch still carries its opaque token.
typedef void (*AnserNotificationCallback)(const char *);
static AnserNotificationCallback activated;
static AnserNotificationCallback failed;
@interface AnserNotificationDelegate : NSObject <UNUserNotificationCenterDelegate>
@end
@implementation AnserNotificationDelegate
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
      willPresentNotification:(UNNotification *)notification
        withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completion {
    completion(UNNotificationPresentationOptionBanner |
               UNNotificationPresentationOptionList |
               UNNotificationPresentationOptionSound);
}
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
 didReceiveNotificationResponse:(UNNotificationResponse *)response
        withCompletionHandler:(void (^)(void))completion {
    if ([response.actionIdentifier isEqualToString:UNNotificationDefaultActionIdentifier]) {
        NSString *token = response.notification.request.content.userInfo[@"anserMailToken"];
        if (activated) activated([token isKindOfClass:NSString.class] ? token.UTF8String : "");
    }
    completion();
}
@end
static AnserNotificationDelegate *delegate;
void anser_notifications_initialize(AnserNotificationCallback onClick,
                                    AnserNotificationCallback onError) {
    activated = onClick;
    failed = onError;
    delegate = [AnserNotificationDelegate new];
    UNUserNotificationCenter.currentNotificationCenter.delegate = delegate;
}
void anser_notification_show(const char *title, const char *body, const char *token) {
    NSString *titleText = [NSString stringWithUTF8String:title];
    NSString *bodyText = [NSString stringWithUTF8String:body];
    NSString *mailToken = [NSString stringWithUTF8String:token];
    // Post on the main queue: the notification-test button runs on the main
    // thread and banners, while background new-mail jobs did not.
    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            UNMutableNotificationContent *content = [UNMutableNotificationContent new];
            content.title = titleText;
            content.body = bodyText;
            content.sound = UNNotificationSound.defaultSound;
            if (@available(macOS 12.0, *)) {
                content.interruptionLevel = UNNotificationInterruptionLevelActive;
            }
            if (mailToken.length) content.userInfo = @{@"anserMailToken": mailToken};
            UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
            [center requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound)
                                  completionHandler:^(BOOL granted, NSError *error) {
                if (!granted || error) {
                    if (failed) failed(error ? error.localizedDescription.UTF8String : "系统通知权限未开启");
                    return;
                }
                UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:
                    (mailToken.length ? mailToken : NSUUID.UUID.UUIDString) content:content trigger:nil];
                [center addNotificationRequest:request withCompletionHandler:^(NSError *error) {
                    if (error && failed) failed(error.localizedDescription.UTF8String);
                }];
            }];
        }
    });
}
