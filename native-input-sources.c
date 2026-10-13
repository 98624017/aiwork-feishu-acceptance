#include <ApplicationServices/ApplicationServices.h>
#include <Carbon/Carbon.h>
#include <stdbool.h>
#include <stdio.h>

static void print_source(const char *kind, TISInputSourceRef source) {
  CFStringRef identifier = TISGetInputSourceProperty(source, kTISPropertyInputSourceID);
  char value[2048];
  if (identifier && CFStringGetCString(identifier, value, sizeof(value), kCFStringEncodingUTF8)) {
    printf("%s\t%s\n", kind, value);
  }
}

int main(void) {
  TISInputSourceRef current = TISCopyCurrentKeyboardInputSource();
  if (current) {
    print_source("current", current);
    CFRelease(current);
  }
  CFArrayRef sources = TISCreateInputSourceList(NULL, false);
  if (sources) {
    for (CFIndex index = 0; index < CFArrayGetCount(sources); index++) {
      TISInputSourceRef source = (TISInputSourceRef)CFArrayGetValueAtIndex(sources, index);
      CFBooleanRef enabled = TISGetInputSourceProperty(source, kTISPropertyInputSourceIsEnabled);
      if (enabled && CFBooleanGetValue(enabled)) print_source("enabled", source);
    }
    CFRelease(sources);
  }
  printf("accessibility\t%s\n", AXIsProcessTrusted() ? "true" : "false");
  return 0;
}
