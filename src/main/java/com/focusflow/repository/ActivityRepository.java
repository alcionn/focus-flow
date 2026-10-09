package com.focusflow.repository;

import com.focusflow.model.Activity;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ActivityRepository
        extends JpaRepository<Activity, Long> {
}