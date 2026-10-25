package berlin.burgerbrothers.shell;

public final class NavigationPolicyTest {
    private static int assertions;
    private static void expect(String url, NavigationPolicy.Target expected) {
        assertions++;
        if (NavigationPolicy.target(url) != expected) throw new AssertionError(url + " must be " + expected);
    }
    public static void main(String[] args) {
        for (String url : new String[]{
            "https://www.burger-brothers.berlin/", "https://burger-brothers.berlin/driver",
            "https://www.burger-brothers.berlin/schnellbestellung/enter?source=android-webview",
            "https://www.burger-brothers.berlin:443/payment/center?recovery=test",
            "https://WWW.BURGER-BROTHERS.BERLIN/menu#burger"
        }) expect(url, NavigationPolicy.Target.INTERNAL);
        for (String url : new String[]{
            "https://checkout.stripe.com/c/pay/test", "https://maps.google.com/", "tel:03040573030",
            "mailto:info@burger-brothers.berlin", "geo:52,13"
        }) expect(url, NavigationPolicy.Target.EXTERNAL);
        for (String url : new String[]{
            null, "", "/menu", "http://www.burger-brothers.berlin/", "javascript:alert(1)",
            "file:///sdcard/private", "content://contacts", "data:text/html,test", "intent://test",
            "https://www.burger-brothers.berlin@evil.example/", "https://user@www.burger-brothers.berlin/",
            "https://www.burger-brothers.berlin:444/", "https://www.burger-brothers.berlin\\@evil.example/",
            "https://%77ww.burger-brothers.berlin/", "https://www.burger-brothers.berlin./"
        }) expect(url, NavigationPolicy.Target.BLOCKED);
        expect("https://www.burger-brothers.berlin.evil.example/", NavigationPolicy.Target.EXTERNAL);
        expect("https://evilburger-brothers.berlin/", NavigationPolicy.Target.EXTERNAL);
        System.out.println("Navigation policy: PASS (" + assertions + " cases)");
    }
}
