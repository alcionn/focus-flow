package com.focusflow;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class FocusFlowApplication {

    public static void main(String[] args) {

        SpringApplication.run(FocusFlowApplication.class, args);

        System.out.println("================================");
        System.out.println("     FOCUSFLOW STARTED");
        System.out.println("================================");
    }
}