CC ?= gcc
CFLAGS ?= -O2 -std=c11 -fno-ident
LDFLAGS ?= -Wl,--build-id=none
all: c124-proof
c124-proof: src/main.c
	$(CC) $(CFLAGS) -ffile-prefix-map=$(CURDIR)=. $(LDFLAGS) -o $@ $<
clean:
	rm -f c124-proof
