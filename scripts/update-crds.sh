#! /usr/bin/env bash

download_github_release() {
    local repo_name=$1
    local pattern=$2

    local awk_extract_url='
    # line of interest is sth like:
    # ```
    #     "browser_download_url": "https://github.com/pulumi/crd2pulumi/releases/download/v1.2.3/crd2pulumi-v1.2.3-linux-arm64.tar.gz"
    # ```
    BEGIN {
        FS = "[ \"]+:?,?"  # `:?` and `,?` account for `":` between key and value, and `",` after the value
    }
    /browser_download_url/ {
        $1 = $1          # force rebuild the record to normalize any leading/middle/trailing FS to OFS
        sub(/^\s+/, "")  # remove leading space
        print $2         # we know for sure the 2nd field is url now
    }
    '

    local url=$( \
        curl --silent "https://api.github.com/repos/${repo_name}/releases/latest" \
        | awk "$awk_extract_url" \
        | grep "$pattern" \
    )

    curl --silent -L "$url" | tar xz
    # ~+ is bashism, expanding to the absolute path of the pwd
    find ~+ -type f -name crd2pulumi
}

fix_crds() {
    # Due to pulumi/crd2pulumi#35 and pulumi/crd2pulumi#30, some output fields
    # have incorrect typing, fix them here after generation until the bugs are
    # fixed.
    echo "Work from $PWD"
    find $(pwd) -type f -iname '*.ts' \
        -exec sed -i 's/public readonly \(metadata\)!: pulumi.Output<\(\S\+\) | undefined>/public readonly \1!: pulumi.Output<\2>/' '{}' '+' \
        -exec sed -i 's/public readonly \(kind\)!: pulumi.Output<\(\S\+\) | undefined>/public readonly \1!: pulumi.Output<\2>/' '{}' '+' \
        -exec sed -i 's/public readonly \(apiVersion\)!: pulumi.Output<\(\S\+\) | undefined>/public readonly \1!: pulumi.Output<\2>/' '{}' '+'
    echo "Done"
}

main() {
    local output=$(pwd)/src/crds

    local dir=$(mktemp -d)
    if [[ ! "$dir" || ! -d "$dir" ]]; then
        >&2 echo "Failed to create temp directory at $dir"
        exit 1
    fi

    trap "exit 1" HUP INT PIPE QUIT TERM
    trap "rm -rf '$dir'" EXIT

    pushd "$dir" >/dev/null

    local crd2pulumi=$(download_github_release pulumi/crd2pulumi linux-amd64)

    mv "$output" "${output}.bak"
    kubectl get crds -o yaml \
        | awk '/^-/ { print "---"; sub(/^- /, ""); print } /^ / { sub(/  /, ""); print } ' \
        | "${crd2pulumi}" -n --nodejsPath "${output}" - \
    && rm -rf "${output}.bak"

    popd >/dev/null

    fix_crds
}

main

